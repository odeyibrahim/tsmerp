// Mirrors the RLS policies in the migrations. Client checks only hide buttons; the database enforces.
const FLEET = ['owner', 'admin', 'ops_manager'];
const TRIPS = ['owner', 'admin', 'ops_manager', 'dispatcher'];
const CUSTOMERS = ['owner', 'admin', 'ops_manager', 'dispatcher', 'accountant'];
const TEAM = ['owner', 'admin'];
export const ROLES = ['owner', 'admin', 'ops_manager', 'accountant', 'dispatcher', 'driver'];
export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', ops_manager: 'Operations manager', accountant: 'Accountant', dispatcher: 'Dispatcher', driver: 'Driver' };
export const can = {
    fleetWrite: (r) => FLEET.includes(r),
    tripWrite: (r) => TRIPS.includes(r),
    customerWrite: (r) => CUSTOMERS.includes(r),
    manageTeam: (r) => TEAM.includes(r),
    editCompany: (r) => TEAM.includes(r),
    seeOffice: (r) => r !== 'driver'
};
