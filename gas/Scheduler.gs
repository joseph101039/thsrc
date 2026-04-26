// 建立一次性時間觸發器；GAS 觸發器不能傳參數，用 ScriptProperties 存 bookingId
function scheduleBooking(bookingId, targetDate) {
  clearTriggerForBooking(bookingId);

  const trigger = ScriptApp.newTrigger('resumeBookingTrigger')
    .timeBased()
    .at(targetDate)
    .create();

  PropertiesService.getScriptProperties()
    .setProperty('trigger_' + trigger.getUniqueId(), bookingId);

  console.log('Scheduled booking', bookingId, 'at', targetDate.toISOString());
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
