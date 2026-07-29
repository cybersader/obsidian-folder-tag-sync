/** Decorative selected-occurrence connectors. Typed relation chips remain semantic. */
export class ConnectorOverlay {
	private readonly svg: SVGSVGElement;
	private readonly resizeObserver: ResizeObserver;
	private frame: number | null = null;
	private selectedOccurrenceKey: string | null = null;
	private readonly handleScroll = (): void => this.schedule();

	constructor(private readonly shell: HTMLElement) {
		this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		this.svg.classList.add('dtf-workbench-connectors');
		this.svg.dataset.dtfConnectorOverlay = '1';
		this.svg.setAttribute('aria-hidden', 'true');
		this.svg.setAttribute('focusable', 'false');
		this.shell.appendChild(this.svg);
		this.shell.addEventListener('scroll', this.handleScroll, true);
		this.resizeObserver = new ResizeObserver(() => this.schedule());
		this.resizeObserver.observe(this.shell);
	}

	update(selectedOccurrenceKey: string | null): void {
		this.selectedOccurrenceKey = selectedOccurrenceKey;
		this.schedule();
	}

	destroy(): void {
		if (this.frame !== null) cancelAnimationFrame(this.frame);
		this.frame = null;
		this.resizeObserver.disconnect();
		this.shell.removeEventListener('scroll', this.handleScroll, true);
		this.svg.remove();
	}

	private schedule(): void {
		if (this.frame !== null) cancelAnimationFrame(this.frame);
		this.frame = requestAnimationFrame(() => {
			this.frame = null;
			this.render();
		});
	}

	private render(): void {
		this.svg.replaceChildren();
		const key = this.selectedOccurrenceKey;
		if (!key || this.shell.clientWidth <= 480) {
			this.svg.style.display = 'none';
			return;
		}

		const source = Array.from(
			this.shell.querySelectorAll<HTMLElement>('[data-dtf-system-occurrence-key]'),
		).find((element) => element.dataset.dtfSystemOccurrenceKey === key);
		if (!source || !isVisible(source)) {
			this.svg.style.display = 'none';
			return;
		}

		const endpoints = [
			...Array.from(this.shell.querySelectorAll<HTMLElement>('[data-dtf-occurrence-key]')),
			...Array.from(this.shell.querySelectorAll<HTMLElement>('[data-dtf-candidate-occurrence-key]')),
		].filter((element) =>
			element.dataset.dtfOccurrenceKey === key
			|| element.dataset.dtfCandidateOccurrenceKey === key)
			.filter((element) => isVisible(element));
		if (endpoints.length === 0) {
			this.svg.style.display = 'none';
			return;
		}

		const shellRect = this.shell.getBoundingClientRect();
		const sourceRect = source.getBoundingClientRect();
		this.svg.style.display = 'block';
		this.svg.setAttribute('viewBox', `0 0 ${shellRect.width} ${shellRect.height}`);
		this.svg.setAttribute('width', String(shellRect.width));
		this.svg.setAttribute('height', String(shellRect.height));

		const startX = sourceRect.left - shellRect.left + sourceRect.width / 2;
		const startY = sourceRect.bottom - shellRect.top;
		for (const endpoint of endpoints) {
			const targetRect = endpoint.getBoundingClientRect();
			const endX = targetRect.left - shellRect.left + targetRect.width / 2;
			const endY = targetRect.top - shellRect.top;
			const middleY = startY + (endY - startY) / 2;
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.dataset.dtfConnector = '1';
			path.setAttribute(
				'd',
				`M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`,
			);
			this.svg.appendChild(path);
		}
	}
}

function isVisible(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0
		&& rect.bottom >= 0 && rect.right >= 0
		&& rect.top <= window.innerHeight && rect.left <= window.innerWidth;
}
