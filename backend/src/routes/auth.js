const express = require('express');
const UserController  = require('../controllers/auth/UserController');
const GoogleController = require('../controllers/GoogleController');
const AuthController  = require('../controllers/AuthController');
const validate        = require('../middlewares/validate');
const {
  loginRules,
  registerRules,
  forgotPasswordRules,
  resetPasswordRules,
  refreshTokenRules,
} = require('../validators/auth.validators');

const router = express.Router();

router.post('/register',        registerRules,        validate, UserController.register);
router.post('/login',           loginRules,           validate, UserController.login);
router.post('/forgot-password', forgotPasswordRules,  validate, AuthController.forgotPassword);
router.post('/reset-password',  resetPasswordRules,   validate, AuthController.resetPassword);
router.post('/refresh',         refreshTokenRules,    validate, AuthController.refreshToken);
router.post('/logout',                                          AuthController.logout);

// GOOGLE
router.post('/google', GoogleController.login);

module.exports = router;