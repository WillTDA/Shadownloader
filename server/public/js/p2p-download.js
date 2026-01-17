const container = document.querySelector('[data-share-code]');
const shareCode = container?.dataset.shareCode;
const shareLinkInput = document.getElementById('share-link');
const copyButton = document.getElementById('copy-link');

if (shareCode && shareLinkInput) {
    shareLinkInput.value = `${window.location.origin}/p2p/${encodeURIComponent(shareCode)}`;
}

if (copyButton && shareLinkInput) {
    copyButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(shareLinkInput.value);
            copyButton.textContent = 'Copied';
            setTimeout(() => {
                copyButton.textContent = 'Copy';
            }, 1500);
        } catch (error) {
            shareLinkInput.select();
        }
    });
}
