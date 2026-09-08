export class ServiceError extends Error {
    constructor(code, message) { super(message); this.name = 'ServiceError'; this.code = code; }
}
export const SERVICE_CONTROL = '__service_control';
export const SERVICE_ROUTE = '__service_route';
export const SERVICE_RESULT = '__service_result';
export const SERVICE_DELIVERY = '__service_delivery';
//# sourceMappingURL=service-types.js.map