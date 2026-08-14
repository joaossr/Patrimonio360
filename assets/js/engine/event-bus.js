/*
==========================================================

 Patrimônio 360 v2

 Event Bus

==========================================================
*/

class EventBus {

    constructor() {

        this.events = {};

    }

    on(event, callback) {

        if (!this.events[event]) {

            this.events[event] = [];

        }

        this.events[event].push(callback);

    }

    emit(event, data = null) {

        if (!this.events[event]) return;

        this.events[event].forEach(callback => {

            callback(data);

        });

    }

    off(event, callback) {

        if (!this.events[event]) return;

        this.events[event] = this.events[event].filter(

            item => item !== callback

        );

    }

}

export default new EventBus();