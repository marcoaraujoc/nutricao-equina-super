const express = require('express');
const UserController = require('../controllers/auth/UserController');
const GoogleController = require('../controllers/GoogleController');
const AuthController = require('../controllers/AuthController');   // ← deve estar importado

const router = express.Router();

router.post('/register', UserController.register);
router.post('/login', UserController.login);
router.post('/forgot-password', AuthController.forgotPassword);
router.post('/reset-password', AuthController.resetPassword);     // ← ADICIONE ESTA LINHA

// GOOGLE
router.post('/google', GoogleController.login);

module.exports = router;