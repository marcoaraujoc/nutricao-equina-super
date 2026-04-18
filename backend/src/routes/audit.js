const express = require('express');
const controller = require('../controllers/AuditController');

const router = express.Router();

router.post('/log', controller.registrar);

module.exports = router;