// Test admin login and dashboard
async function testAdmin() {
  try {
    const loginRes = await fetch('http://localhost:3000/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' })
    });
    
    const cookie = loginRes.headers.get('set-cookie');
    console.log('Login cookie:', !!cookie);
    const loginData = await loginRes.json();
    console.log('Login response:', loginData);
    
    // Test dashboard access
    const dashRes = await fetch('http://localhost:3000/admin.html', {
      headers: { 'Cookie': cookie }
    });
    const html = await dashRes.text();
    console.log('Dashboard HTML length:', html.length);
    console.log('Has login overlay:', html.includes('admin-login-overlay'));
    console.log('Has admin-nav-tabs:', html.includes('admin-nav-tabs'));
    
    // Test API endpoints
    const productsRes = await fetch('http://localhost:3000/api/admin/products', {
      headers: { 'Cookie': cookie }
    });
    const productsData = await productsRes.json();
    console.log('Products API:', productsData.success ? 'OK' : 'FAIL', productsData.products?.length);
    
    const plansRes = await fetch('http://localhost:3000/api/admin/plans', {
      headers: { 'Cookie': cookie }
    });
    const plansData = await plansRes.json();
    console.log('Plans API:', plansData.success ? 'OK' : 'FAIL', plansData.plans?.length);
    
    const variantsRes = await fetch('http://localhost:3000/api/admin/supplier-variants', {
      headers: { 'Cookie': cookie }
    });
    const variantsData = await variantsRes.json();
    console.log('Variants API:', variantsData.success ? 'OK' : 'FAIL', variantsData.mappings?.length);
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testAdmin();