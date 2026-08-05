(function process(request, response) {
  try {
    new ApplicationHomeHandler().handlePost(request, response);
  } catch (e) {
    response.setStatus(500);
    response.setContentType('application/json');
    response.setBody({
      error: (e && e.message) ? String(e.message) : String(e),
    });
  }
})(request, response);
