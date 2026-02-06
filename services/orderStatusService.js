// Order lifecycle:
// Pickup: processing -> packing -> ready_for_pickup -> completed
// Delivery: processing -> packing -> shipped -> completed
// Refunded is terminal and only set by the refund workflow.
const STATUS_FLOW = {
    pickup: ['processing', 'packing', 'ready_for_pickup', 'completed'],
    delivery: ['processing', 'packing', 'shipped', 'completed']
};

const ALL_STATUSES = ['processing', 'packing', 'ready_for_pickup', 'shipped', 'completed', 'refunded'];

const LEGACY_STATUS_MAP = {
    pending: 'processing',
    packed: 'packing',
    delivered: 'completed',
    returned: 'refunded',
    cancelled: 'refunded'
};

const toKey = (value) => String(value || '').trim().toLowerCase();

const mapLegacyStatus = (value) => {
    const key = toKey(value);
    return LEGACY_STATUS_MAP[key] || key;
};

const resolveStatus = (value) => {
    const key = mapLegacyStatus(value);
    return ALL_STATUSES.includes(key) ? key : null;
};

const resolveDeliveryMethod = (value) => (toKey(value) === 'pickup' ? 'pickup' : 'delivery');

const getFlowForMethod = (method) => (resolveDeliveryMethod(method) === 'pickup' ? STATUS_FLOW.pickup : STATUS_FLOW.delivery);

const getStatusIndex = (status, method) => {
    const flow = getFlowForMethod(method);
    const key = mapLegacyStatus(status);
    return flow.indexOf(key);
};

const getNextStatus = (currentStatus, method) => {
    const flow = getFlowForMethod(method);
    const currentIndex = getStatusIndex(currentStatus, method);
    if (currentIndex < 0) {
        return flow[0] || null;
    }
    if (currentIndex >= flow.length - 1) {
        return null;
    }
    return flow[currentIndex + 1];
};

const canTransition = (currentStatus, nextStatus, method) => {
    const flow = getFlowForMethod(method);
    const currentIndex = getStatusIndex(currentStatus, method);
    const nextKey = mapLegacyStatus(nextStatus);
    const nextIndex = flow.indexOf(nextKey);

    if (nextIndex < 0) {
        return false;
    }
    if (currentIndex < 0) {
        return nextIndex === 0;
    }
    return nextIndex === currentIndex || nextIndex === currentIndex + 1;
};

const isRefundedStatus = (status) => mapLegacyStatus(status) === 'refunded';
const isCompletedStatus = (status) => mapLegacyStatus(status) === 'completed';

module.exports = {
    STATUS_FLOW,
    ALL_STATUSES,
    mapLegacyStatus,
    resolveStatus,
    resolveDeliveryMethod,
    getFlowForMethod,
    getStatusIndex,
    getNextStatus,
    canTransition,
    isRefundedStatus,
    isCompletedStatus
};
