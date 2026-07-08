async function checkCandle() {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=COMBOUSDT&interval=1h&limit=1`);
  const data = await res.json();
  console.log(data);
}
checkCandle();
