// 建立一次性時間觸發器；GAS 觸發器不能傳參數，用 ScriptProperties 存 bookingId
function scheduleBooking(bookingId, targetDate) {
  const trigger = ScriptApp.newTrigger('resumeBookingTrigger')
    .timeBased()
    .at(targetDate)
    .create();

  PropertiesService.getScriptProperties()
    .setProperty('trigger_' + trigger.getUniqueId(), bookingId);

  console.log('Scheduled booking', bookingId, 'at', targetDate.toISOString());
}

// 清除所有孤兒觸發器（ScriptProperties 已無對應 bookingId 的觸發器）
function cleanOrphanTriggers() {
  const props = PropertiesService.getScriptProperties().getProperties();
  let deleted = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    const key = 'trigger_' + trigger.getUniqueId();
    if (!props[key] && trigger.getHandlerFunction() !== 'pollPendingBookings') {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  console.log('Deleted orphan triggers:', deleted);
}

// 每分鐘輪詢 pending bookings，一次只跑一筆
// 由永久性每分鐘觸發器呼叫（用 installPoller 安裝一次）
function pollPendingBookings() {
  const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
  const now = new Date();

  // 將 running 超過 10 分鐘的 booking 重置為 pending（上次執行超時卡死）
  bookings.forEach(b => {
    if (b.status !== CONFIG.BOOKING_STATUS.RUNNING) return;
    const updatedAt = b.updatedAt ? new Date(b.updatedAt) : null;
    if (updatedAt && (now - updatedAt) > 10 * 60 * 1000) {
      console.log('Resetting stuck running booking:', b.id);
      updateBookingFields(b.id, { status: CONFIG.BOOKING_STATUS.PENDING });
    }
  });

  // 重新讀取（狀態可能剛被更新）
  const fresh = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);

  // 找第一筆可執行的 pending，一次只跑一筆
  const next = fresh.find(b => {
    if (b.status !== CONFIG.BOOKING_STATUS.PENDING) return false;
    if (b.scheduledAt && new Date(b.scheduledAt) > now) return false;
    return true;
  });

  if (next) {
    console.log('Polling: running booking', next.id);
    runBooking(next.id);
  }
}

// 安裝永久性每分鐘輪詢觸發器（只需執行一次）
function installPoller() {
  const existing = ScriptApp.getProjectTriggers()
    .find(t => t.getHandlerFunction() === 'pollPendingBookings');
  if (existing) { console.log('Poller already installed'); return; }
  ScriptApp.newTrigger('pollPendingBookings')
    .timeBased().everyMinutes(1).create();
  console.log('Poller installed');
}

// 移除輪詢觸發器
function uninstallPoller() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pollPendingBookings')
    .forEach(t => ScriptApp.deleteTrigger(t));
  console.log('Poller removed');
}

// 觸發器入口（GAS 觸發器只能呼叫無參數函式）
function resumeBookingTrigger(e) {
  const triggerId = e.triggerUid;
  const props = PropertiesService.getScriptProperties();
  const bookingId = props.getProperty('trigger_' + triggerId);

  if (!bookingId) {
    console.error('No bookingId found for trigger:', triggerId);
    return;
  }

  props.deleteProperty('trigger_' + triggerId);
  clearTriggerById(triggerId);

  runBooking(bookingId);
}

function clearTriggerForBooking(bookingId) {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  ScriptApp.getProjectTriggers().forEach(trigger => {
    const key = 'trigger_' + trigger.getUniqueId();
    if (allProps[key] === bookingId) {
      props.deleteProperty(key);
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function clearTriggerById(triggerId) {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getUniqueId() === triggerId) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

// 排程重試（等待 RETRY_WAIT_MINUTES 後再試）
function scheduleRetry(bookingId) {
  const retryAt = new Date(Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000);
  scheduleBooking(bookingId, retryAt);
}

function test_scheduler() {
  const future = new Date(Date.now() + 5 * 60 * 1000);
  scheduleBooking('test-booking-id', future);
  console.log('Active triggers:', ScriptApp.getProjectTriggers().length);

  clearTriggerForBooking('test-booking-id');
  console.log('After clear:', ScriptApp.getProjectTriggers().length);
}
