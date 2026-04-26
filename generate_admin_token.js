const { generateToken } = require('./backend/utils/jwt');
require('dotenv').config();

const adminToken = generateToken({
    userId: 'admin',
    username: 'Administrator',
    role: 'admin'
});

console.log('====================================================');
console.log('🚀 SEU TOKEN DE ADMINISTRADOR (PRIMARY API):');
console.log('----------------------------------------------------');
console.log(adminToken);
console.log('====================================================');
console.log('Use este token no header da Segunda API:');
console.log('Authorization: Bearer ' + adminToken);
