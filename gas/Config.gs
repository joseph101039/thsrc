const CONFIG = {
  SHEET_NAME_BOOKINGS: 'bookings',
  SHEET_NAME_PASSENGERS: 'passengers',
  MAX_EXECUTION_MS: 5 * 60 * 1000, // 5 分鐘，保留 1 分鐘緩衝
  RETRY_WAIT_MINUTES: 2,            // 無可用班次或驗證碼超時時等待分鐘數
  CAPTCHA_API_URL: 'http://35.212.154.47:8080',

  STATIONS: ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'],

  PASSENGER_TYPES: {
    adult:    '成人',
    student:  '學生',
    senior:   '敬老',
    disabled: '愛心',
    child:    '兒童',
  },

  BOOKING_STATUS: {
    PENDING:         'pending',
    RUNNING:         'running',
    WAITING_CAPTCHA: 'waiting_captcha',
    SUCCESS:         'success',
    FAILED:          'failed',
  },

  // bookings sheet 欄位索引（0-based）
  BOOKING_COLS: {
    ID: 0, PASSENGER_ID: 1, FROM_STATION: 2, TO_STATION: 3, DATE: 4,
    DESIRED_TIME: 5, EARLIEST_TIME: 6, LATEST_TIME: 7,
    MAX_RETRIES: 8, SCHEDULED_AT: 9, STATUS: 10,
    RETRY_COUNT: 11, TRAIN_NO: 12, TICKET_NO: 13,
    CREATED_AT: 14, UPDATED_AT: 15,
  },

  // passengers sheet 欄位索引（0-based）
  PASSENGER_COLS: {
    ID: 0, NAME: 1, ID_NUMBER: 2, TYPE: 3, EMAIL: 4,
  },
};
