'use strict';

const express = require('express');
const cors = require('cors');
const CONFIG = require('./config');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', (req, res) => {
  const { action, data, id } = req.body || {};
  try {
    let result;
    switch (action) {
      case 'getPassengers':   result = { passengers: db.getPassengers() };   break;
      case 'savePassenger':   result = db.savePassenger(data);               break;
      case 'deletePassenger': result = db.deletePassenger(id);               break;
      case 'getBookings':     result = { bookings: db.getBookings() };       break;
      case 'createBooking':   result = db.createBooking(data);               break;
      case 'deleteBooking':        result = db.deleteBooking(id);                          break;
      case 'getBookingAttempts':   result = { attempts: db.getAttemptsByBookingId(id) };  break;
      default:
        return res.status(400).json({ error: 'Unknown action: ' + action });
    }
    res.json(result);
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const port = CONFIG.PORT;
app.listen(port, () => {
  console.log('THSRC server listening on port', port);
});

module.exports = app;
