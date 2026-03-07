/**
 * Security Console Manager
 * ========================
 * Manages the scrolling security log with color-coded entries
 */

class SecurityConsole {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.maxLines = 50;
        this.lastEventCount = 0;
    }

    addLine(type, message, timestamp) {
        if (!this.container) return;

        const line = document.createElement('div');
        line.className = 'console-line';

        const time = timestamp
            ? new Date(timestamp * 1000).toLocaleTimeString('en-US', { hour12: false })
            : new Date().toLocaleTimeString('en-US', { hour12: false });

        // Map event types to CSS classes
        let typeClass = 'info';
        let typeLabel = type;

        switch (type) {
            case 'QUANTUM_TX':
                typeClass = 'quantum';
                typeLabel = 'Q-TX';
                break;
            case 'COLLISION_WARNING':
                typeClass = 'warning';
                typeLabel = 'WARN';
                break;
            case 'SECURITY_BREACH':
                typeClass = 'breach';
                typeLabel = 'BREACH';
                break;
            case 'SECURE':
                typeClass = 'secure';
                typeLabel = 'OK';
                break;
            case 'QSDC_RESULT':
                typeClass = 'quantum';
                typeLabel = 'QSDC';
                break;
            case 'ML_EVENT':
                typeClass = 'info';
                typeLabel = 'ML';
                break;
            default:
                typeClass = 'info';
                typeLabel = type.substring(0, 6);
        }

        line.innerHTML = `
            <span class="console-time">${time}</span>
            <span class="console-type ${typeClass}">${typeLabel}</span>
            <span class="console-msg">${this._escapeHtml(message)}</span>
        `;

        this.container.appendChild(line);

        // Trim old lines
        while (this.container.children.length > this.maxLines) {
            this.container.removeChild(this.container.firstChild);
        }

        // Auto-scroll to bottom
        this.container.scrollTop = this.container.scrollHeight;
    }

    updateFromEvents(events) {
        if (!events || events.length === 0) return;

        // Only add new events
        const newEvents = events.slice(this.lastEventCount);
        newEvents.forEach(evt => {
            this.addLine(evt.type, evt.message, evt.timestamp);
        });
        this.lastEventCount = events.length;
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
