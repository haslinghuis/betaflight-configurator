import { Serial, SerialDriverEnum } from "@adeunis/capacitor-serial";
import { serialDevices, vendorIdNames } from "./devices";

const logHead = "[Capacitor Serial]";

class CapacitorSerialProtocol extends EventTarget {
    constructor() {
        super();

        this.connected = false;
        this.connectionInfo = null;

        this.bytesSent = 0;
        this.bytesReceived = 0;
        this.isOpen = false;
        this.port = null;
        this.ports = [];

        this.connectionId = null;
        this.reading = false;

        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.handleReceiveBytes = this.handleReceiveBytes.bind(this);

        this.loadDevices();
    }

    handleReceiveBytes(info) {
        console.log(`${logHead} Received ${info.detail.byteLength} bytes`);
        this.bytesReceived += info.detail.byteLength;
    }

    getConnectedPort() {
        return this.connectionId;
    }

    handleNewDevice(vid, pid) {
        const added = this.createPort(vid, pid);
        this.ports.push(added);
        this.dispatchEvent(new CustomEvent("addedDevice", { detail: added }));
        return added;
    }

    createPort(vid, pid) {
        // Avoid duplicates
        if (this.ports.some((p) => p.vendorId === vid && p.productId === pid)) {
            return null;
        }
        const displayName = vendorIdNames[vid] ? vendorIdNames[vid] : `VID:${vid} PID:${pid}`;

        return {
            path: "serial",
            displayName: `Betaflight ${displayName}`,
            vendorId: vid,
            productId: pid,
        };
    }

    handleDeviceRemoval(vid, pid) {
        const index = this.ports.findIndex((p) => p.vendorId === vid && p.productId === pid);
        if (index !== -1) {
            const removed = this.ports.splice(index, 1)[0];
            this.dispatchEvent(new CustomEvent("removedDevice", { detail: removed }));
            console.log(`${logHead} Device removed: VID:${vid} PID:${pid}`);
        }
    }

    async loadDevices() {
        // Return cached devices to avoid redundant permission requests
        if (this.ports.length > 0) {
            return this.ports;
        }

        return this.requestPermissionDevice();
    }

    async getDevices() {
        await this.loadDevices();
        return this.ports;
    }

    async connect(path, options = { baudRate: 115200 }) {
        try {
            await Serial.openConnection(options);
            console.log(`${logHead} Serial connection opened with options:`, options);
            this.isOpen = true;
            this.connectionId = path;
        } catch (error) {
            console.error(`${logHead} Error opening serial connection:`, error);
            this.dispatchEvent(new CustomEvent("connect", { detail: false }));
            return false;
        }

        this.addEventListener("receive", this.handleReceiveBytes);

        // Register callback-based reading
        await Serial.registerReadCallback((message, error) => {
            if (message?.data) {
                console.log("Received Data:", message.data);
                this.dispatchEvent(new CustomEvent("receive", { detail: message.data }));
            } else if (error) {
                console.error(`${logHead} Error reading serial data:`, error);
                return;
            }
        });

        this.dispatchEvent(new CustomEvent("connect", { detail: true }));
        console.log(`${logHead} Connected to ${path}`);

        return true;
    }

    /**
     * Request serial permissions for a device.
     */
    async requestPermissionDevice() {
        for (const { vendorId, productId } of serialDevices) {
            try {
                const permissionResponse = await Serial.requestSerialPermissions({
                    vendorId,
                    productId,
                    driver: SerialDriverEnum.CDC_ACM_SERIAL_DRIVER,
                });
                if (permissionResponse.granted) {
                    const exists = this.ports.some((p) => p.vendorId === vendorId && p.productId === productId);
                    if (!exists) {
                        this.handleNewDevice(vendorId, productId);
                    }
                    return true;
                }
            } catch {
                // Ignore errors during permission requests
            }
        }

        return false;
    }

    async send(data, callback) {
        try {
            await Serial.write({ data });
            console.log("Data sent", data);
            callback?.({ bytesSent: data.byteLength });
            return true;
        } catch (error) {
            console.log(`error : ${error}`);
            callback?.({ bytesSent: 0 });
            return false;
        }
    }

    async disconnect() {
        if (!this.isOpen) return;
        this.reading = false;
        let closeError = null;
        try {
            await Serial?.unregisterReadCallback();
            await Serial?.closeConnection();
        } catch (error) {
            closeError = error;
        } finally {
            this.isOpen = false;
            this.port = null;
            this.dispatchEvent(new CustomEvent("disconnect", { detail: true }));
        }
        if (closeError) {
            throw new Error("Failed to close serial port", { cause: closeError });
        }
    }
}

export default CapacitorSerialProtocol;
