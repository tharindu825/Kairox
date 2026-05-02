async function listModels() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const data = await res.json();
    const geminiModels = data.data
      .filter(m => m.id.toLowerCase().includes('gemini'))
      .map(m => m.id);
    console.log('Gemini Models:', JSON.stringify(geminiModels, null, 2));
  } catch (err) {
    console.error('Error fetching models:', err);
  }
}

if (typeof fetch !== 'undefined') {
  listModels();
} else {
  console.error('fetch is not available in this environment. Please use Node.js 18+ or provide a polyfill.');
}
