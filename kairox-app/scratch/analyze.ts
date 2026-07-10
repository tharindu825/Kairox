import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const uri = process.env.MONGODB_URI;
const user = process.env.MONGODB_USER;
const pass = process.env.MONGODB_PASS;

let authUri = uri;
if (user && pass && uri?.includes('mongodb+srv://') && !uri.includes('@')) {
  authUri = uri.replace('mongodb+srv://', `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`);
}

if (!authUri) throw new Error('MONGODB_URI is not defined in .env');

async function analyze() {
  const client = new MongoClient(authUri);
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db('kairox'); // assuming db name is kairox from the connection string or client default
    
    const signals = await db.collection('signals').find({}).toArray();
    const paperOrders = await db.collection('paperOrders').find({}).toArray();
    
    console.log(`Total signals: ${signals.length}`);
    console.log(`Total paperOrders: ${paperOrders.length}`);
    
    let winTrades = 0;
    let lossTrades = 0;
    let winTradesApproved = 0;
    let winTradesNotApproved = 0;
    
    let approvedSignals = 0;
    let approvedSignalsToProfit = 0;
    let approvedSignalsToLoss = 0;
    let approvedSignalsNotClosed = 0;
    
    // Create signal map
    const signalMap = new Map();
    for (const sig of signals) {
      signalMap.set(sig._id.toString(), sig);
      if (sig.status === 'APPROVED' || sig.isApproved === true) {
         approvedSignals++;
      }
    }
    
    for (const order of paperOrders) {
      const isWin = order.pnl > 0;
      const isLoss = order.pnl < 0;
      
      const sig = order.signalId ? signalMap.get(order.signalId.toString()) : null;
      const isSigApproved = sig ? (sig.status === 'APPROVED' || sig.status === 'ACTIVE' || sig.isApproved === true) : false; // We need to check what 'approved' means in this schema.
      
      if (order.status === 'CLOSED') {
        if (isWin) {
          winTrades++;
          if (isSigApproved) winTradesApproved++;
          else winTradesNotApproved++;
        }
        if (isLoss) {
          lossTrades++;
        }
      }
    }
    
    for (const sig of signals) {
      const isApproved = (sig.status === 'APPROVED' || sig.status === 'ACTIVE' || sig.isApproved === true);
      if (isApproved) {
        // Find corresponding order(s)
        const ordersForSig = paperOrders.filter(o => o.signalId && o.signalId.toString() === sig._id.toString());
        if (ordersForSig.length > 0) {
          let hasProfit = false;
          let hasLoss = false;
          let allOpen = true;
          for (const o of ordersForSig) {
            if (o.status === 'CLOSED') {
              allOpen = false;
              if (o.pnl > 0) hasProfit = true;
              if (o.pnl < 0) hasLoss = true;
            }
          }
          if (hasProfit) approvedSignalsToProfit++;
          else if (hasLoss) approvedSignalsToLoss++;
          else if (allOpen) approvedSignalsNotClosed++;
        } else {
          approvedSignalsNotClosed++; // no order yet
        }
      }
    }

    console.log('--- Analysis Results ---');
    console.log(`Win Trades: ${winTrades}`);
    console.log(`Loss Trades: ${lossTrades}`);
    console.log(`Win Trades with Approved Signal: ${winTradesApproved}`);
    console.log(`Win Trades with Non-Approved Signal: ${winTradesNotApproved}`);
    
    console.log(`Total Approved Signals: ${approvedSignals}`); // NOTE: This count depends on exactly how 'approved' is defined.
    console.log(`Approved Signals -> Profit: ${approvedSignalsToProfit}`);
    console.log(`Approved Signals -> Loss: ${approvedSignalsToLoss}`);
    console.log(`Approved Signals -> Not Closed or No Order: ${approvedSignalsNotClosed}`);
    
    console.log('Sample signal status values:', [...new Set(signals.map(s => s.status))]);
    console.log('Sample order status values:', [...new Set(paperOrders.map(o => o.status))]);
    
  } finally {
    await client.close();
  }
}

analyze().catch(console.error);
