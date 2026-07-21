// --- Villacart Favorites UI module ---
// v8.0.57: Extracted from app.js. Keep loaded before app.js so startup can render favorites.

    function toggleFavoritesMode() {
        favoritesEditMode = !favoritesEditMode;
        favoriteDragState = null;
        favoriteDragSuppressClick = false;
        const btn = document.getElementById('fav-mode-btn');
        btn.innerText = favoritesEditMode ? "Done Editing" : "Edit Slots";
        btn.classList.toggle('text-primary', favoritesEditMode);
        btn.classList.toggle('text-primary/40', !favoritesEditMode);
        renderFavorites();
    }

    function addFavoriteSlot() {
        state.favorites.push(null);
        sync();
        renderFavorites();
        showToast("Slot added", "success");
    }

    function removeFavoriteSlot(index, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        state.favorites.splice(index, 1);
        sync();
        renderFavorites();
        showToast("Slot removed", "info");
    }

    let favoriteDragState = null;
    let favoriteDragSuppressClick = false;

    function favoriteSlotShell(index, innerHtml) {
        const dragAttrs = favoritesEditMode
            ? ` data-fav-index="${index}" onpointerdown="beginFavoriteDrag(event, ${index})" onpointermove="moveFavoriteDrag(event)" onpointerup="endFavoriteDrag(event)" onpointercancel="cancelFavoriteDrag(event)"`
            : ` data-fav-index="${index}"`;
        const touchClass = favoritesEditMode ? 'touch-none' : 'touch-pan-y';
        return `<div class="favorite-slot relative h-[90px] md:h-32 ${touchClass} select-none"${dragAttrs}>${innerHtml}</div>`;
    }

    function saveFavoriteColors() {
        try { localStorage.setItem(FAV_COLOR_KEY, JSON.stringify(favoriteSlotColors || {})); } catch(e) {}
    }

    function favoriteColorValue(index) {
        const value = favoriteSlotColors && favoriteSlotColors[String(index)] ? String(favoriteSlotColors[String(index)]) : '';
        return favoriteColorPalette.some(color => color.value === value) ? value : '';
    }

    function favoriteColorStyle(index) {
        const value = favoriteColorValue(index);
        return value ? ` style="background-color: ${value};"` : '';
    }

    function favoriteSlotControls(index) {
        if (!favoritesEditMode) return '';
        return `${favoriteEditOverlay()}${favoriteColorButton(index)}${favoriteRemoveButton(index)}`;
    }

    function favoriteColorButton(index) {
        if (!favoritesEditMode) return '';
        return `<button data-fav-color="true" onclick="openFavoriteColorPicker(${index}, event)" class="absolute top-1 left-1 bg-white/90 text-primary w-6 h-6 rounded-full flex items-center justify-center shadow-md active:scale-90 z-20 border border-primary/10" title="Change color"><span class="material-symbols-outlined text-[14px]">palette</span></button>`;
    }

    function favoriteEditOverlay() {
        if (!favoritesEditMode) return '';
        return `<div class="absolute inset-0 bg-primary/75 flex flex-col items-center justify-center text-white gap-1 pointer-events-none">
            <span class="material-symbols-outlined text-[22px]">drag_indicator</span>
            <span class="text-[7px] md:text-[9px] font-black uppercase tracking-widest">Drag</span>
        </div>`;
    }

    function favoriteRemoveButton(index) {
        if (!favoritesEditMode) return '';
        return `<button data-fav-remove="true" onclick="removeFavoriteSlot(${index}, event)" class="absolute top-1 right-1 bg-error text-white w-6 h-6 rounded-full flex items-center justify-center shadow-md active:scale-90 z-20">
            <span class="material-symbols-outlined text-[14px]">close</span>
        </button>`;
    }

    function favoriteBaseButtonClass(kind) {
        if (kind === 'empty') return 'w-full h-full border-2 border-dashed border-primary/10 rounded-2xl flex flex-col items-center justify-center gap-1 active-scale group hover:border-primary/30 transition-colors';
        if (kind === 'missing') return 'w-full h-full border-2 border-dashed border-error/20 rounded-2xl flex flex-col items-center justify-center text-error/50';
        return 'relative w-full h-full border border-border-subtle rounded-2xl flex flex-col items-center justify-center px-1.5 pt-2 pb-6 md:px-2 md:pt-3 md:pb-7 overflow-hidden active-scale shadow-sm hover:shadow-md transition-all';
    }

    function favoriteStockClass(product) {
        const stockCount = Math.max(0, Number(product.stock) || 0);
        if (stockCount <= 0) return 'text-error bg-error/10';
        if (stockCount <= (Number(product.lowStock) || 5)) return 'text-amber-700 bg-amber-50';
        return 'text-primary/60 bg-primary/5';
    }

    function renderFavoriteEmptySlot(index) {
        return favoriteSlotShell(index, `<button onclick="openFavoritesPicker(${index})" class="${favoriteBaseButtonClass('empty')}"${favoriteColorStyle(index)}>
            <span class="material-symbols-outlined text-[20px] md:text-[28px] text-primary/30 group-hover:text-primary transition-colors">add</span>
            <span class="text-[7px] md:text-[10px] font-black uppercase text-primary/30 group-hover:text-primary transition-colors">Set Slot</span>
        </button>${favoriteSlotControls(index)}`);
    }

    function renderFavoriteMissingSlot(index) {
        return favoriteSlotShell(index, `<button onclick="openFavoritesPicker(${index})" class="${favoriteBaseButtonClass('missing')}"${favoriteColorStyle(index)}>
            <span class="material-symbols-outlined">error</span>
        </button>${favoriteSlotControls(index)}`);
    }

    function favoriteProductContent(product) {
        const stockCount = Math.max(0, Number(product.stock) || 0);
        return `<span class="text-[9px] md:text-[13px] font-black text-primary leading-tight line-clamp-2 md:line-clamp-3 text-center uppercase">${escapeHTML(product.name)}</span>
            <span class="text-[11px] md:text-[16px] font-black text-secondary mt-1 leading-none">${formatCurrency(product.price)}</span>
            <span class="absolute bottom-1.5 md:bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap px-1 md:px-2 py-0.5 rounded-full text-[6px] md:text-[8px] font-black uppercase tracking-wide ${favoriteStockClass(product)}">Stock: ${stockCount}</span>`;
    }

    function renderFavoriteProductSlot(fav, index) {
        const product = state.inventory.find(p => p.id === fav.id);
        if (!product) return renderFavoriteMissingSlot(index);
        return favoriteSlotShell(index, `<button onclick="handleFavoriteClick(${index})" class="${favoriteBaseButtonClass('product')}"${favoriteColorStyle(index)}>
            ${favoriteProductContent(product)}
        </button>${favoriteSlotControls(index)}`);
    }

    function renderFavorites() {
        const grid = document.getElementById('favorites-grid');
        if (!grid) return;
        let html = state.favorites.map((fav, index) => fav ? renderFavoriteProductSlot(fav, index) : renderFavoriteEmptySlot(index)).join('');
        if (favoritesEditMode) {
            html += `<button onclick="addFavoriteSlot()" class="h-[90px] md:h-32 border-2 border-primary/20 bg-primary/5 rounded-2xl flex flex-col items-center justify-center gap-1 active-scale group hover:bg-primary/10 transition-colors">
                <span class="material-symbols-outlined text-[20px] md:text-[28px] text-primary">add_circle</span>
                <span class="text-[7px] md:text-[10px] font-black uppercase text-primary">Add New Slot</span>
            </button>`;
        }
        grid.innerHTML = html;
    }

    function beginFavoriteDrag(event, index) {
        if (!favoritesEditMode || event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.target && event.target.closest && event.target.closest('[data-fav-remove="true"],[data-fav-color="true"]')) return;
        favoriteDragState = {
            from: index,
            startX: event.clientX,
            startY: event.clientY,
            dragging: false,
            slot: event.currentTarget
        };
        if (favoriteDragState.slot && favoriteDragState.slot.setPointerCapture) {
            try { favoriteDragState.slot.setPointerCapture(event.pointerId); } catch(e) {}
        }
    }

    function moveFavoriteDrag(event) {
        if (!favoriteDragState) return;
        const dx = event.clientX - favoriteDragState.startX;
        const dy = event.clientY - favoriteDragState.startY;
        if (!favoriteDragState.dragging && Math.hypot(dx, dy) > 10) {
            favoriteDragState.dragging = true;
            if (favoriteDragState.slot) {
                favoriteDragState.slot.style.opacity = '0.55';
                favoriteDragState.slot.style.transform = 'scale(0.96)';
                favoriteDragState.slot.style.zIndex = '30';
            }
        }
        if (favoriteDragState.dragging) {
            event.preventDefault();
            if (favoriteDragState.slot) favoriteDragState.slot.style.transform = `translate(${dx}px, ${dy}px) scale(0.96)`;
        }
    }

    function reorderFavoriteSlot(fromIndex, toIndex) {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.favorites.length || toIndex >= state.favorites.length) return false;
        const moved = state.favorites.splice(fromIndex, 1)[0];
        state.favorites.splice(toIndex, 0, moved);
        sync();
        renderFavorites();
        return true;
    }

    function endFavoriteDrag(event) {
        if (!favoriteDragState) return;
        const drag = favoriteDragState;
        favoriteDragState = null;
        if (drag.slot) {
            drag.slot.style.opacity = '';
            drag.slot.style.transform = '';
            drag.slot.style.zIndex = '';
        }
        if (!drag.dragging) return;
        event.preventDefault();
        event.stopPropagation();
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const targetSlot = target && target.closest ? target.closest('[data-fav-index]') : null;
        const toIndex = targetSlot ? Number(targetSlot.getAttribute('data-fav-index')) : drag.from;
        favoriteDragSuppressClick = true;
        const changed = reorderFavoriteSlot(drag.from, toIndex);
        if (changed) showToast('Favorite moved', 'success');
        setTimeout(() => { favoriteDragSuppressClick = false; }, 150);
    }

    function cancelFavoriteDrag() {
        if (favoriteDragState && favoriteDragState.slot) {
            favoriteDragState.slot.style.opacity = '';
            favoriteDragState.slot.style.transform = '';
            favoriteDragState.slot.style.zIndex = '';
        }
        favoriteDragState = null;
    }

    function handleFavoriteClick(index) {
        if (favoriteDragSuppressClick) return;
        if (favoritesEditMode) { openFavoritesPicker(index); } else {
            const fav = state.favorites[index];
            if (fav) {
                const product = state.inventory.find(p => p.id === fav.id);
                if (product && product.packPrice && product.packPrice > 0) openScanChoiceModal(product);
                else addToCart(fav.id, 'piece');
            }
        }
    }

    function openFavoritesPicker(index) {
        currentFavSlotIndex = index;
        document.getElementById('fav-picker-search').value = '';
        const btn = document.getElementById('fav-remove-slot-btn');
        if (btn) btn.classList.toggle('hidden', !favoritesEditMode);
        renderFavPickerList();
        closeModal('fav-picker-modal');
        document.getElementById('fav-picker-modal').classList.replace('hidden', 'flex');
    }

    function renderFavPickerList(query = '') {
        const list = document.getElementById('fav-picker-list');
        const filtered = state.inventory.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
        if (filtered.length === 0) { list.innerHTML = `<div class="p-4 text-center text-xs opacity-50 font-bold uppercase">No matches</div>`; return; }
        list.innerHTML = filtered.map(p => `<button onclick="assignFavorite(${jsArg(p.id)})" class="w-full p-4 bg-surface-container/30 border border-border-subtle rounded-2xl flex justify-between items-center active-scale hover:bg-primary-container transition-colors text-left"><div class="min-w-0 flex-1"><p class="text-xs font-black text-primary uppercase truncate">${escapeHTML(p.name)}</p><p class="text-[10px] font-bold text-on-surface-variant">${escapeHTML(p.category || 'General')}</p></div><p class="text-xs font-black text-secondary ml-2">${formatCurrency(p.price)}</p></button>`).join('');
    }

    function assignFavorite(productId) { if (currentFavSlotIndex === null) return; state.favorites[currentFavSlotIndex] = { id: productId }; sync(); renderFavorites(); closeModal('fav-picker-modal'); showToast("Slot updated", "success"); }
    function clearFavoriteSlot() { if (currentFavSlotIndex === null) return; state.favorites[currentFavSlotIndex] = null; sync(); renderFavorites(); closeModal('fav-picker-modal'); showToast("Slot cleared", "info"); }
    function removeFavoriteSlotAction() { if (currentFavSlotIndex === null) return; removeFavoriteSlot(currentFavSlotIndex); closeModal('fav-picker-modal'); }

    function openFavoriteColorPicker(index, event) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        currentFavSlotIndex = index;
        const list = document.getElementById('fav-color-palette');
        if (!list) return;
        const current = favoriteColorValue(index);
        list.innerHTML = favoriteColorPalette.map(color => {
            const selected = current === color.value;
            const swatch = color.value || '#FFFFFF';
            return `<button onclick="setFavoriteColor('${color.value}', ${index})" class="fav-color-chip ${selected ? 'selected' : ''}" style="--fav-chip-color:${swatch}"><span></span><small>${escapeHTML(color.name)}</small></button>`;
        }).join('');
        closeModal('fav-picker-modal');
        document.getElementById('fav-color-modal').classList.replace('hidden', 'flex');
    }

    function setFavoriteColor(value, index = currentFavSlotIndex) {
        if (index === null || index === undefined) return;
        const key = String(index);
        if (!value) delete favoriteSlotColors[key];
        else favoriteSlotColors[key] = value;
        saveFavoriteColors();
        renderFavorites();
        closeModal('fav-color-modal');
        showToast(value ? 'Favorite color updated' : 'Favorite color reset', 'success');
    }

    function clearFavoriteColor() {
        setFavoriteColor('', currentFavSlotIndex);
    }
