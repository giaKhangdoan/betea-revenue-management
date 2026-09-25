export function ActionMessage({ error, success }: { error?: string; success?: string }) {
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (success) return <p className="form-success" role="status">{success}</p>;
  return null;
}
