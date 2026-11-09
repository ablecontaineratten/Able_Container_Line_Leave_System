// Employee app (/request/) for plain employees. The screens live in components/emp-app.js,
// shared with the full system (a head / admin / super admin who is also an employee sees them there).
import { startStandalone } from './components/emp-app.js';

startStandalone(document.querySelector('#root'));
