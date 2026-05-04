'use strict';

const passengerService = require('../services/passengerService');

/**
 * @swagger
 * /v1/passengers:
 *   get:
 *     summary: 取得所有旅客
 *     tags: [Passengers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 旅客列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 passengers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Passenger'
 */
function listPassengers(req, res) {
  try {
    res.json({ passengers: passengerService.listPassengers() });
  } catch (err) {
    console.error('listPassengers error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/passengers:
 *   post:
 *     summary: 新增或更新旅客
 *     tags: [Passengers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PassengerInput'
 *     responses:
 *       200:
 *         description: 儲存成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 id:
 *                   type: string
 */
function savePassenger(req, res) {
  try {
    res.json(passengerService.savePassenger(req.body));
  } catch (err) {
    console.error('savePassenger error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/passengers/{id}:
 *   delete:
 *     summary: 刪除旅客
 *     tags: [Passengers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 刪除成功
 */
function deletePassenger(req, res) {
  try {
    res.json(passengerService.deletePassenger(req.params.id));
  } catch (err) {
    console.error('deletePassenger error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listPassengers, savePassenger, deletePassenger };
