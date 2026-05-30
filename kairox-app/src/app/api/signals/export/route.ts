import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';

function escapeCsv(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in quotes if it contains a comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatPrice(price: any): string {
  const p = Number(price);
  if (!Number.isFinite(p)) return '';
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(5);
  return p.toFixed(6);
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const side = searchParams.get('side') || 'ALL';
    const status = searchParams.get('status') || 'ALL';
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 0; // 0 = no limit

    const db = await getDb();

    const query: any = {};
    if (side !== 'ALL') query.side = side;
    if (status !== 'ALL') query.status = status;

    const cursor = db.collection('signals')
      .find(query)
      .sort({ createdAt: -1 });

    if (limit > 0) cursor.limit(limit);
    const signals = await cursor.toArray();

    // Batch-fetch related data
    const signalIds = signals.map(s => s._id.toString());

    const [riskDocs, tradeDocs] = await Promise.all([
      db.collection('riskAssessments').find({ signalId: { $in: signalIds } }).toArray(),
      db.collection('paperOrders').find({ signalId: { $in: signalIds } }).toArray(),
    ]);

    const riskMap = new Map(riskDocs.map(r => [r.signalId, r]));
    const tradeMap = new Map(tradeDocs.map(t => [t.signalId, t]));

    // CSV header
    const headers = [
      'Signal ID',
      'Symbol',
      'Timeframe',
      'Side',
      'Entry Price',
      'Stop Loss',
      'TP1',
      'TP2',
      'TP3',
      'Confidence %',
      'Signal Status',
      'Risk Verdict',
      'R:R Ratio',
      'Position Size',
      'Risk %',
      'Model Agreement',
      'Trade Outcome',
      'P&L (USDT)',
      'P&L %',
      'Created At (UTC)',
      'Reasoning',
    ];

    const rows: string[][] = [headers];

    for (const sig of signals) {
      const id = sig._id.toString();
      const risk = riskMap.get(id);
      const trade = tradeMap.get(id);

      // Parse targets
      const targets: { label: string; price: number }[] = Array.isArray(sig.targets) ? sig.targets : [];
      const tp1 = targets.find(t => t.label === 'TP1' || t.label?.includes('1'))?.price;
      const tp2 = targets.find(t => t.label === 'TP2' || t.label?.includes('2'))?.price;
      const tp3 = targets.find(t => t.label === 'TP3' || t.label?.includes('3'))?.price;

      // Trade outcome
      let tradeOutcome = 'No Trade';
      let pnlUsdt = '';
      let pnlPct = '';
      if (trade) {
        if (trade.status === 'OPEN') {
          tradeOutcome = 'Open';
        } else if (trade.status === 'CLOSED') {
          tradeOutcome = Number(trade.pnl) >= 0 ? 'TP Hit ✓' : 'Closed (Loss)';
        } else if (trade.status === 'STOPPED') {
          tradeOutcome = 'SL Hit ✗';
        }
        if (trade.pnl !== undefined && trade.pnl !== null) {
          pnlUsdt = Number(trade.pnl).toFixed(2);
          const paperBalance = Number(process.env.PAPER_BALANCE || 10000);
          pnlPct = paperBalance > 0 ? ((Number(trade.pnl) / paperBalance) * 100).toFixed(2) : '';
        }
      }

      // Model agreement (check signalVotes)
      const votes = await db.collection('signalVotes').find({ signalId: id }).toArray();
      const primaryVote = votes.find(v => v.role === 'PRIMARY')?.side;
      const confVote = votes.find(v => v.role === 'CONFIRMATION')?.side;
      const agreement = primaryVote && confVote ? (primaryVote === confVote ? 'Yes' : 'No') : 'N/A';

      rows.push([
        id,
        sig.symbol,
        sig.timeframe || '4h',
        sig.side,
        formatPrice(sig.entry),
        formatPrice(sig.stopLoss),
        tp1 !== undefined ? formatPrice(tp1) : '',
        tp2 !== undefined ? formatPrice(tp2) : '',
        tp3 !== undefined ? formatPrice(tp3) : '',
        sig.confidence !== undefined ? (sig.confidence * 100).toFixed(0) : '',
        sig.status || '',
        risk?.verdict || '',
        risk?.rewardToRisk !== undefined ? Number(risk.rewardToRisk).toFixed(2) : '',
        risk?.positionSize !== undefined ? Number(risk.positionSize).toFixed(4) : '',
        risk?.riskPercent !== undefined ? Number(risk.riskPercent).toFixed(2) : '',
        agreement,
        tradeOutcome,
        pnlUsdt,
        pnlPct,
        sig.createdAt ? new Date(sig.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '',
        sig.reasoning || '',
      ]);
    }

    const csvContent = rows.map(row => row.map(escapeCsv).join(',')).join('\r\n');

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `kairox-signals-${timestamp}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API] Failed to export signals:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
