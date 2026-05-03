'use strict';

const CONFIG = {
  PORT: parseInt(process.env.PORT || '8081', 10),
  DB_PATH: process.env.DB_PATH || './data/thsrc.db',
  CAPTCHA_API_URL: process.env.CAPTCHA_API_URL || 'http://35.212.154.47:8080',
  RETRY_WAIT_MINUTES: 2,
  MAX_RETRIES_DEFAULT: 10,
  STUCK_BOOKING_MINUTES: 10,

  STATIONS: ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'],

  STATION_CODES: {
    '南港': '1', '台北': '2', '板橋': '3', '桃園': '4',
    '新竹': '5', '苗栗': '6', '台中': '7', '彰化': '8',
    '雲林': '9', '嘉義': '10', '台南': '11', '左營': '12',
  },

  PASSENGER_TYPES: {
    adult: '成人',
    student: '學生',
    senior: '敬老',
    disabled: '愛心',
    child: '兒童',
  },

  BOOKING_STATUS: {
    PENDING: 'pending',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
  },

  REFUND_STATUS: {
    REFUNDING: 'refunding',
    REFUNDED: 'refunded',
    REFUND_FAILED: 'refund_failed',
  },
};

module.exports = CONFIG;
