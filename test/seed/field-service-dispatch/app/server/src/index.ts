export default {
  port: 3000,
  fetch() {
    return Response.json({ ok: true, openWorkOrders: 14 });
  },
};
