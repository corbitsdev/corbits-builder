export default {
  port: 3000,
  fetch() {
    return Response.json({ ok: true, protocol: "CARDIO-301", enrolled: 18 });
  },
};
