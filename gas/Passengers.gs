function getPassengers() {
  const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
  return { passengers };
}

function savePassenger(data) {
  const { id, name, idNumber, type, email } = data;

  if (id) {
    updateRowFields(CONFIG.SHEET_NAME_PASSENGERS, id, CONFIG.PASSENGER_COLS, {
      name, idNumber, type, email,
    });
    return { success: true, id };
  } else {
    const newId = generateId();
    appendRow(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS, {
      id: newId, name, idNumber, type, email,
    });
    return { success: true, id: newId };
  }
}

function deletePassenger(id) {
  deleteRowById(CONFIG.SHEET_NAME_PASSENGERS, id);
  return { success: true };
}

function test_passengers() {
  const created = savePassenger({ name: '測試者', idNumber: 'A123456789', type: 'adult', email: 'test@example.com' });
  console.log('created:', JSON.stringify(created));

  const list = getPassengers();
  console.log('list:', JSON.stringify(list));

  savePassenger({ id: created.id, name: '測試者2', idNumber: 'A123456789', type: 'senior', email: 'test2@example.com' });
  console.log('after update:', JSON.stringify(getPassengers()));

  deletePassenger(created.id);
  console.log('after delete:', JSON.stringify(getPassengers()));
}
