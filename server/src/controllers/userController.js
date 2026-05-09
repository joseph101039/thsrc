'use strict';

const userService = require('../services/userService');
const logger = require('../logger');

/**
 * @swagger
 * /v1/users:
 *   get:
 *     summary: 取得所有允許使用者（admin only）
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 使用者列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AllowedUser'
 */
function listUsers(req, res) {
  try {
    res.json({ users: userService.listUsers() });
  } catch (err) {
    (req.log || logger).error({ err: err.message }, 'listUsers error');
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/users:
 *   post:
 *     summary: 新增允許使用者（admin only）
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, role]
 *             properties:
 *               email:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [user, admin]
 *     responses:
 *       200:
 *         description: 新增成功或失敗
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 */
function addUser(req, res) {
  try {
    const result = userService.addUser(req.body || {});
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    (req.log || logger).error({ err: err.message }, 'addUser error');
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/users/{email}:
 *   delete:
 *     summary: 刪除允許使用者（admin only）
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 刪除成功
 *       400:
 *         description: 不能刪除自己
 */
function deleteUser(req, res) {
  try {
    const result = userService.deleteUser(req.params.email, req.user.email);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    (req.log || logger).error({ err: err.message }, 'deleteUser error');
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listUsers, addUser, deleteUser };
