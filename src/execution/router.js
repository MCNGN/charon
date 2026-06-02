import { now, json } from '../utils.js';
import { numSetting, boolSetting } from '../db/settings.js';
import { db } from '../db/connection.js';
import { getWrappedNative, getMinReserve } from '../config.js';
import { escapeHtml, fmtNative } from '../format.js';
import { getActiveChain, fromSmallestUnit, toSmallestUnit } from '../chain/index.js';
import { executeSwap, liveWalletBalanceLamports, fetchLiveTokenBalance } from '../liveExecutor.js';
import { activeStrategy } from '../db/settings.js';
import { createLivePosition, canOpenMorePositions, openPositionCount } from '../db/positions.js';
import { intentById } from '../db/intents.js';
import { logDecisionEvent } from '../db/decisions.js';
import { refreshCandidateForExecution } from './positions.js';
import { bot } from '../telegram/bot.js';
import { candidateSummary } from '../telegram/format.js';
import { sendPositionOpen, sendTelegram } from '../telegram/send.js';
import { updateCandidateStatus } from '../db/candidates.js';
import { createTradeIntent } from '../db/intents.js';

/**
 * Compute position size in smallest unit (lamports/wei).
 * Reads the 'position_size_sol' setting from the strategy (DB compat)
 * and converts to the chain's smallest unit.
 */
function computePositionAmount() {
  const strat = activeStrategy();
  // 'position_size_sol' is the DB field name — kept for backward compat
  const nativeAmount = strat.position_size_sol ?? numSetting('dry_run_buy_sol', 0.1);
  return Number(toSmallestUnit(nativeAmount));
}

export async function executeLiveBuy(selectedRow, decision, batchId, rows = [], triggerCandidateId = null) {
  const chain = getActiveChain();
  const nativeSymbol = chain.nativeToken.symbol;
  const wrappedNative = getWrappedNative();
  const amountSmallestUnit = computePositionAmount();
  const minReserve = getMinReserve();

  const balance = await liveWalletBalanceLamports();
  if (balance < amountSmallestUnit + minReserve) {
    const needed = fromSmallestUnit(amountSmallestUnit + minReserve);
    throw new Error(`Insufficient ${nativeSymbol} balance. Need ${fmtNative(needed)} including reserve.`);
  }

  const swap = await executeSwap({
    inputMint: wrappedNative,
    outputMint: selectedRow.candidate.token.mint,
    amount: amountSmallestUnit,
  });
  if (!swap.outputAmount) {
    swap.outputAmount = await fetchLiveTokenBalance(selectedRow.candidate.token.mint) || swap.outputAmount;
  }
  const positionId = createLivePosition(selectedRow.id, selectedRow.candidate, decision, swap, `live_batch_${batchId}`);
  logDecisionEvent({
    batchId,
    triggerCandidateId,
    selectedRow,
    rows,
    decision,
    mode: 'live',
    action: 'live_entry_executed',
    guardrails: { balanceLamports: balance, amountLamports: amountSmallestUnit, minReserveLamports: minReserve },
    execution: { positionId, swap },
  });
  await sendPositionOpen(positionId);
}

export async function executeLiveSell(position, reason) {
  const chain = getActiveChain();
  const wrappedNative = getWrappedNative();
  const amount = position.token_amount_raw || position.token_amount_est;
  if (!amount || Number(amount) <= 0) throw new Error('Live position has no token amount to sell.');
  return executeSwap({
    inputMint: position.mint,
    outputMint: wrappedNative,
    amount,
  });
}

export async function executeConfirmedIntent(chatId, intentId) {
  const intent = intentById(intentId);
  if (!intent || intent.status !== 'pending_confirmation') return bot.sendMessage(chatId, 'Pending intent not found.');
  if (!canOpenMorePositions()) {
    return bot.sendMessage(chatId, `Max open positions reached (${openPositionCount()}/${numSetting('max_open_positions', 3)}).`);
  }
  const { decision } = intent.payload;
  try {
    const freshRow = await refreshCandidateForExecution({
      id: intent.candidate_id,
      candidate: intent.payload.candidate,
    });
    if (!freshRow.candidate.filters?.passed) {
      db.prepare('UPDATE trade_intents SET status = ?, updated_at_ms = ? WHERE id = ?').run('rejected_stale', now(), intentId);
      return bot.sendMessage(chatId, [
        '🛑 <b>Trade intent rejected on fresh check</b>',
        '',
        candidateSummary(freshRow.candidate, decision),
        '',
        `Failures: ${escapeHtml((freshRow.candidate.filters?.failures || []).join('; ') || 'fresh execution guard failed')}`,
      ].join('\n'), { parse_mode: 'HTML', disable_web_page_preview: true });
    }

    const chain = getActiveChain();
    const nativeSymbol = chain.nativeToken.symbol;
    const wrappedNative = getWrappedNative();
    const amountSmallestUnit = computePositionAmount();
    const minReserve = getMinReserve();

    const balance = await liveWalletBalanceLamports();
    if (balance < amountSmallestUnit + minReserve) {
      const needed = fromSmallestUnit(amountSmallestUnit + minReserve);
      db.prepare('UPDATE trade_intents SET status = ?, updated_at_ms = ? WHERE id = ?').run('rejected_insufficient_balance', now(), intentId);
      return bot.sendMessage(chatId, `Insufficient ${nativeSymbol} balance. Need ${fmtNative(needed)}.`, { parse_mode: 'HTML' });
    }
    const swap = await executeSwap({
      inputMint: wrappedNative,
      outputMint: freshRow.candidate.token.mint,
      amount: amountSmallestUnit,
    });
    if (!swap.outputAmount) {
      swap.outputAmount = await fetchLiveTokenBalance(freshRow.candidate.token.mint) || swap.outputAmount;
    }
    const positionId = createLivePosition(intent.candidate_id, freshRow.candidate, decision, swap, `confirmed_intent_${intentId}`);
    db.prepare('UPDATE trade_intents SET status = ?, updated_at_ms = ? WHERE id = ?').run('executed_live', now(), intentId);
    logDecisionEvent({
      batchId: null,
      triggerCandidateId: intent.candidate_id,
      selectedRow: freshRow,
      rows: [],
      decision,
      mode: 'live',
      action: 'confirmed_intent_executed',
      guardrails: { balanceLamports: balance, amountLamports: amountSmallestUnit, intentId },
      execution: { positionId, swap },
    });
    return sendPositionOpen(positionId);
  } catch (err) {
    db.prepare('UPDATE trade_intents SET status = ?, updated_at_ms = ? WHERE id = ?').run('execution_failed', now(), intentId);
    return bot.sendMessage(chatId, `Live execution failed: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
}

export async function rejectIntent(chatId, intentId) {
  const intent = intentById(intentId);
  if (!intent) return bot.sendMessage(chatId, 'Intent not found.');
  db.prepare('UPDATE trade_intents SET status = ?, updated_at_ms = ? WHERE id = ?').run('rejected', now(), intentId);
  return bot.sendMessage(chatId, `Rejected trade intent #${intentId}.`);
}
