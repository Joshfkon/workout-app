#!/usr/bin/env node
/**
 * Test MuscleWiki API endpoints to find the right one
 */

const API_KEY = 'a404975499mshd431c84bef0985fp1ac6bdjsn486157400cf7';
const API_HOST = 'musclewiki-api.p.rapidapi.com';
const BASE_URL = 'https://musclewiki-api.p.rapidapi.com';

async function testEndpoints() {
  console.log('Testing MuscleWiki API endpoints...\n');
  
  // Test getting a specific exercise by ID (we know Barbell Curl is ID 0)
  console.log('1. Testing /exercises/0 (Barbell Curl by ID):');
  try {
    const response = await fetch(`${BASE_URL}/exercises/0`, {
      headers: {
        'X-RapidAPI-Key': API_KEY,
        'X-RapidAPI-Host': API_HOST
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Success!');
      console.log('Keys:', Object.keys(data));
      console.log('Sample data:', JSON.stringify(data, null, 2).substring(0, 2000));
    } else {
      console.log(`❌ Status: ${response.status}`);
      console.log(await response.text());
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  console.log('\n2. Testing search for "barbell curl":');
  try {
    const response = await fetch(`${BASE_URL}/exercises?name=barbell%20curl`, {
      headers: {
        'X-RapidAPI-Key': API_KEY,
        'X-RapidAPI-Host': API_HOST
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Success!');
      console.log('Structure:', Object.keys(data));
      if (data.results && data.results.length > 0) {
        console.log('First result keys:', Object.keys(data.results[0]));
        console.log('First result:', JSON.stringify(data.results[0], null, 2));
      }
    } else {
      console.log(`❌ Status: ${response.status}`);
      console.log(await response.text());
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testEndpoints().catch(console.error);

