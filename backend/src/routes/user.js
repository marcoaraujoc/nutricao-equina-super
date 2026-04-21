const express = require('express');
const router = express.Router();

const UserController = require('../controllers/UserController');
const { authenticate } = require('../middlewares/auth');

router.get('/me', authenticate, UserController.getMe);
router.put('/me', authenticate, UserController.updateMe);

module.exports = router;