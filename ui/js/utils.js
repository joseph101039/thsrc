function maskId(idNumber, passengerEmail, myEmail) {
  if (passengerEmail === myEmail) return idNumber;
  if (!idNumber || idNumber.length <= 5) return idNumber;
  const mid = idNumber.length - 5;
  return idNumber.slice(0, 3) + '*'.repeat(mid) + idNumber.slice(-2);
}
