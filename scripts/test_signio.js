import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

async function testSignio() {
  console.log('🔄 Probando conexión con Signio...');
  console.log('URL:', process.env.SIGNIO_API_URL);
  console.log('Email:', process.env.SIGNIO_EMAIL);
  
  try {
    const response = await fetch(process.env.SIGNIO_API_URL + '/token/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.SIGNIO_EMAIL,
        password: process.env.SIGNIO_PASSWORD
      })
    });
    
    const data = await response.json();
    console.log('Respuesta:', JSON.stringify(data, null, 2));
    
    if (data.codigo === '00') {
      console.log('✅ ¡Conexión exitosa! Token obtenido.');
    } else {
      console.log('❌ Error:', data.mensaje);
    }
  } catch (error) {
    console.log('❌ Error de conexión:', error.message);
  }
}

testSignio();
