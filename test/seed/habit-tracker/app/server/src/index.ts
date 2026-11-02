export default {
  port: 3000,
  fetch() {
    return Response.json({ ok: true, habitsCompletedToday: 3 });
  },
};
