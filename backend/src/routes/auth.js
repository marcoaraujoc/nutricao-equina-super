const express = require('express');
const UserController = require('../controllers/auth/UserController');
const GoogleController = require('../controllers/GoogleController');

const router = express.Router();

router.post('/register', UserController.register);
router.post('/login', UserController.login);

// ==================== GOOGLE LOGIN ====================
router.post('/google', GoogleController.login);

module.exports = router;
