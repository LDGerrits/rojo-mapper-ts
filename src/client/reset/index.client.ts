async function setCore() {
	const resetBindable = new Instance("BindableEvent");

	resetBindable.Event.Connect(() => {
		
	});
}

Promise.retryWithDelay(setCore, 10, 5);