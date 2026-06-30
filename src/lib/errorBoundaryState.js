export function createErrorBoundaryState(error) {
  return {
    hasError: true,
    message: error instanceof Error && error.message
      ? error.message
      : 'Unknown UI error',
  };
}
