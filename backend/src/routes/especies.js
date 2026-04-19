const express = require('express');
const router = express.Router();
const especieController = require('../controllers/EspecieController');

router.get('/', especieController.getAll);

module.exports = router;