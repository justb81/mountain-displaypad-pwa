/**
 * A one-shot timer that fires {@link onElapse} unless {@link clear}ed in time.
 *
 * Used by {@link DisplayPad} to notice a firmware desync: the transfer protocol
 * is announce→ack driven, so after a machine suspend the pad's firmware resets
 * and simply stops acking, leaving the write queue stuck forever with no error
 * thrown (the `sendReport` calls are fire-and-forget). Arming on each pending
 * write and clearing on its ack turns "no ack within {@link timeoutMs}" into an
 * explicit signal — one that fires even on a throttled background timer, so the
 * pad can be reopened without the app needing focus.
 *
 * Pure and browser-free (only `setTimeout`/`clearTimeout`) so it is unit-tested
 * with fake timers, unlike the WebHID-bound {@link DisplayPad} that owns it.
 */
export class AckWatchdog {
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly timeoutMs: number,
		private readonly onElapse: () => void
	) {}

	/** (Re)start the countdown; a prior pending countdown is discarded. */
	arm(): void {
		this.clear();
		this.timer = setTimeout(() => {
			this.timer = null;
			this.onElapse();
		}, this.timeoutMs);
	}

	/** Cancel a pending countdown, if any. Safe to call when not armed. */
	clear(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}
