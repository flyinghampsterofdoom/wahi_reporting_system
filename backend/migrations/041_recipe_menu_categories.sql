-- Preserve legacy on_menu/off_menu rows and immutable publication history.
-- on_menu is displayed as Cocktails; legacy off_menu rows remain available in All.
ALTER TABLE wahi_v2.recipe_book_entries
 DROP CONSTRAINT recipe_book_entries_menu_status_check;
ALTER TABLE wahi_v2.recipe_book_entries
 ADD CONSTRAINT recipe_book_entries_menu_status_check
 CHECK(menu_status IN ('on_menu','off_menu','shareables','mocktails','the_dive','specials','old_specials'));
