#!/usr/bin/env node
/**
 * Test script to check MuscleWiki API structure
 */

const testUrl = 'https://api.musclewiki.com/exercises?name=bench%20press';

console.log('Testing MuscleWiki API...');
console.log('URL:', testUrl);
console.log('');

try {
  const response = await fetch(testUrl);
  console.log('Status:', response.status);
  console.log('Content-Type:', response.headers.get('content-type'));
  
  const data = await response.json();
  console.log('\nResponse structure:');
  console.log(JSON.stringify(data, null, 2).substring(0, 1000));
  
  if (Array.isArray(data) && data.length > 0) {
    console.log('\nFirst exercise keys:', Object.keys(data[0]));
    console.log('First exercise:', JSON.stringify(data[0], null, 2).substring(0, 500));
  }
} catch (err) {
  console.error('Error:', err.message);
}

