// Fetch free models from OpenRouter API
async function main() {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  const { data } = await res.json();
  
  const free = data.filter(m => 
    parseFloat(m.pricing?.prompt || '1') === 0 && 
    parseFloat(m.pricing?.completion || '1') === 0
  );
  
  // Sort by context length descending
  free.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
  
  console.log(`\n=== ${free.length} FREE MODELS on OpenRouter ===\n`);
  
  for (const m of free) {
    const supportsJSON = (m.supported_parameters || []).includes('response_format');
    const supportsStructured = (m.supported_parameters || []).includes('structured_outputs');
    const supportsTools = (m.supported_parameters || []).includes('tools');
    
    console.log(`ID: ${m.id}`);
    console.log(`  Name: ${m.name}`);
    console.log(`  Context: ${m.context_length?.toLocaleString()} tokens`);
    console.log(`  JSON mode: ${supportsJSON ? 'YES' : 'NO'} | Structured: ${supportsStructured ? 'YES' : 'NO'} | Tools: ${supportsTools ? 'YES' : 'NO'}`);
    console.log(`  Max completion: ${m.top_provider?.max_completion_tokens?.toLocaleString() || 'unknown'}`);
    console.log('');
  }
}

main().catch(console.error);
