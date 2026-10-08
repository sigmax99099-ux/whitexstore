// Check for JavaScript errors in admin panel
async function checkAdmin() {
  try {
    const loginRes = await fetch('http://localhost:3000/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' })
    });
    
    const cookie = loginRes.headers.get('set-cookie');
    console.log('Login cookie:', !!cookie);
    
    // Fetch dashboard and check for JS errors
    const dashRes = await fetch('http://localhost:3000/admin.html', {
      headers: { 'Cookie': cookie }
    });
    const html = await dashRes.text();
    
    // Check if the script tag is present and has the right content
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    if (scriptMatch) {
      const script = scriptMatch[1];
      console.log('Script tag length:', script.length);
      console.log('Has DOMContentLoaded:', script.includes('DOMContentLoaded'));
      console.log('Has initAdminAuth:', script.includes('initAdminAuth'));
      console.log('Has loadAdminSupplierVariants:', script.includes('loadAdminSupplierVariants'));
      console.log('Has loadSupplierCatalog:', script.includes('loadSupplierCatalog'));
      console.log('Has loadAdminSupplierMappings:', script.includes('loadAdminSupplierMappings'));
      console.log('Has loadSvmDropdowns:', script.includes('loadSvmDropdowns'));
      console.log('Has openSvmMappingModal:', script.includes('openSvmMappingModal'));
      console.log('Has populateSvmPlans:', script.includes('populateSvmPlans'));
      
      // Check for syntax errors
      try {
        new Function(script);
        console.log('Script syntax: OK');
      } catch (e) {
        console.log('Script syntax ERROR:', e.message);
        // Find the line with error
        const lines = script.split('\n');
        for (let i = 0; i < lines.length; i++) {
          try {
            new Function(lines.slice(0, i+1).join('\n'));
          } catch (e) {
            console.log('Error near line', i+1, ':', lines[i].substring(0, 100));
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkAdmin();