// Turn PostgREST / Postgres errors into something a dispatcher can act on.
export function friendlyError(error) {
    if (!error) return '';
    const m = error.message || 'Something went wrong';
    switch (error.code) {
        case 'NETWORK': return m;
        case '23505': return 'That record already exists (duplicate plate number, licence number or similar).';
        case '23503': return 'One of the selected records does not belong to your company or no longer exists.';
        case '42501': return "You don't have permission to do that.";
        case 'PGRST116': return 'Record not found.';
        case '23514': return m.replace(/^new row for relation .* violates check constraint .*/i, 'One of the values is not allowed.');
        case '54000': return m;
        default: return m;
    }
}
