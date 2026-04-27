export function routeRevenue(count, unit) {
  return (Number(count) || 0) * (Number(unit) || 0);
}
