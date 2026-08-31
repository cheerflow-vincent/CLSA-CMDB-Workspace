(function process(request, response) {
  try {
    new CiSearchDistinctCountHandler().handleFlagCountsPost(request, response);
  } catch (error) {
    response.setStatus(500);
    response.setContentType('application/json');
    response.setBody({
      error: (error?.message) ? String(error.message) : String(error),
    });
  }
})(request, response);
