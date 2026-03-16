(function() {

  class ItemList {
    constructor(item_class, key) {
      this.item_class = item_class;
      this.key = key;
      this.items = [];
      this.items_bykey = {};
    }

    sync(rows) {
      this.items.splice(0, this.items.length);
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var current_obj = this.items_bykey[row[this.key]];
        if (current_obj) {
          current_obj.row = row;
          this.items.push(current_obj);
        } else {
          var item = new this.item_class(row, this);
          this.items_bykey[row[this.key]] = item;
          this.items.push(item);
        }
      }
    }

    deleteItem(item) {
      var index = this.items.indexOf(item);
      if (index > -1) {
        this.items.splice(index, 1);
      } else {
        console.log("Can't delete item", item);
      }
      delete this.items_bykey[item.row[this.key]];
    }
  }

  window.ItemList = ItemList;

})();
