require('dotenv').config();

async function test() {
  try {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbklkIjoxLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzkxMzI4NDE2LCJleHAiOjE3OTE1MDEyMTZ9.ZLgEl77qZ3m0Jd4mIb6dUvg7I1EQ83lI9l2vdqV6tXs';
    const res = await fetch('http://localhost:3000/api/admin/supplier-apis', {
      headers: { 'Cookie': 'admin_token=' + token }
    });
    const data = await res.json();
    console.log('Success:', data.success);
    console.log('Count:', data.apis.length);
    data.apis.forEach(a => console.log('  ID:', a.id, '| Name:', a.name, '| Type:', a.api_type, '| URL:', a.api_url.substring(0,50)));
  } catch (e) {
    console.error('Error:', e);
  }
}

test();