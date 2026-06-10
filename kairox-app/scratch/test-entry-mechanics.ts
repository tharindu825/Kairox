import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { paperTradingService } from '../src/services/paper-trading';
import { redis } from '../src/lib/redis';

async function main() {
  const uri = process.env.MONGODB_URI!;
  const options: Record<string, unknown> = {};
  if (process.env.MONGODB_USER && process.env.MONGODB_PASS) {
    options.auth = {
      username: process.env.MONGODB_USER,
      password: process.env.MONGODB_PASS,
    };
  }

  const client = new MongoClient(uri, options);
  await client.connect();
  const db = client.db('kairox');

  console.log('--- STARTING ENTRY MECHANICS VERIFICATION ---');

  const testSymbol = 'TESTENTRYUSDT';

  // Cleanup existing test data
  await db.collection('paperOrders').deleteMany({ symbol: testSymbol });
  await db.collection('signals').deleteMany({ symbol: testSymbol });

  // 1. Test case: Immediate fill for LONG order (current price is below limit entry)
  console.log('\nTest Case 1: Immediate fill for LONG order...');
  // Setup Redis ticker price to $9.50
  await redis.hset('market:ticker', { [testSymbol]: '9.50' });

  const signalLongId = new ObjectId();
  await db.collection('signals').insertOne({
    _id: signalLongId,
    symbol: testSymbol,
    timeframe: '4h',
    side: 'LONG',
    entry: 10.00, // limit is $10.00, current price is $9.50
    stopLoss: 9.00,
    targets: [{ price: 12.00, label: 'TP1' }],
    status: 'APPROVED',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const longOrder = await paperTradingService.executeApprovedSignal(signalLongId.toString(), 100);
  console.log(`Created Long Order Status: ${longOrder?.status} | Entry Price: ${longOrder?.entryPrice}`);
  if (longOrder?.status === 'OPEN' && longOrder?.entryPrice === 9.5) {
    console.log('✅ Test Case 1 Passed! Immediately filled at market price $9.50.');
  } else {
    console.log('❌ Test Case 1 Failed!');
  }

  // 2. Test case: Immediate fill for SHORT order (current price is above limit entry)
  console.log('\nTest Case 2: Immediate fill for SHORT order...');
  // Setup Redis ticker price to $10.50
  await redis.hset('market:ticker', { [testSymbol]: '10.50' });

  const signalShortId = new ObjectId();
  await db.collection('signals').insertOne({
    _id: signalShortId,
    symbol: testSymbol,
    timeframe: '4h',
    side: 'SHORT',
    entry: 10.00, // limit is $10.00, current price is $10.50
    stopLoss: 11.00,
    targets: [{ price: 8.00, label: 'TP1' }],
    status: 'APPROVED',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const shortOrder = await paperTradingService.executeApprovedSignal(signalShortId.toString(), 100);
  console.log(`Created Short Order Status: ${shortOrder?.status} | Entry Price: ${shortOrder?.entryPrice}`);
  if (shortOrder?.status === 'OPEN' && shortOrder?.entryPrice === 10.5) {
    console.log('✅ Test Case 2 Passed! Immediately filled at market price $10.50.');
  } else {
    console.log('❌ Test Case 2 Failed!');
  }

  // 3. Test case: Pending order triggers when limit is crossed
  console.log('\nTest Case 3: Pending trigger when limit is crossed...');
  // Current price is $11.00, so Buy Limit at $10.00 sits as PENDING
  await redis.hset('market:ticker', { [testSymbol]: '11.00' });

  const signalPendingId = new ObjectId();
  await db.collection('signals').insertOne({
    _id: signalPendingId,
    symbol: testSymbol,
    timeframe: '4h',
    side: 'LONG',
    entry: 10.00, // limit is $10.00, current price is $11.00
    stopLoss: 9.00,
    targets: [{ price: 12.00, label: 'TP1' }],
    status: 'APPROVED',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const pendingOrder = await paperTradingService.executeApprovedSignal(signalPendingId.toString(), 100);
  console.log(`Created Pending Order Status: ${pendingOrder?.status} | Entry Price: ${pendingOrder?.entryPrice}`);
  
  if (pendingOrder?.status === 'PENDING') {
    console.log('Order successfully placed as PENDING.');
    
    // Now simulate a candle tick that crosses the entry (low goes to $9.50)
    console.log('Simulating candle tick with low=$9.50, high=$10.50...');
    const testCandle = {
      symbol: testSymbol,
      timeframe: '4h',
      timestamp: Date.now(),
      open: 10.50,
      high: 10.50,
      low: 9.50, // candle low <= entryPrice ($10.00)
      close: 9.80,
      volume: 1000,
      isClosed: false,
    };
    
    await paperTradingService.processLiveTick(testCandle);
    
    // Fetch order from DB to verify it opened
    const updatedPendingOrder = await db.collection('paperOrders').findOne({ _id: new ObjectId(pendingOrder.id) });
    console.log(`Updated Pending Order Status: ${updatedPendingOrder?.status} | Entry Price: ${updatedPendingOrder?.entryPrice}`);
    
    if (updatedPendingOrder?.status === 'OPEN' && updatedPendingOrder?.entryPrice === 10.00) {
      console.log('✅ Test Case 3 Passed! Pending order opened at target entry price $10.00 when candle low went to $9.50.');
    } else {
      console.log('❌ Test Case 3 Failed!');
    }
  } else {
    console.log('❌ Test Case 3 Failed! Order was not placed as PENDING.');
  }

  // Cleanup test data
  await db.collection('paperOrders').deleteMany({ symbol: testSymbol });
  await db.collection('signals').deleteMany({ symbol: testSymbol });
  await redis.hdel('market:ticker', testSymbol);

  await client.close();
  console.log('\n--- VERIFICATION COMPLETED ---');
  process.exit(0);
}

main().catch(console.error);
