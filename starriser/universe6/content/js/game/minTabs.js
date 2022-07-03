"use strict";
var MinTabs = function (data) {
	this.init(data);
};

MinTabs.prototype.init = function(data) {

	this.titleClass = (typeof data !== "undefined" && typeof data.titleClass !== "undefined") ? data.titleClass : false ;
	
	this.selectedTab = false;
	this.selectedContent = false;
	this.tabs = [];
	this.contents = [];

	this.container = document.createElement("div").setClass("minTabs");
	this.titleContainer = document.createElement("div").setClass("tabs");
	this.contentContainer = document.createElement("div").setClass("contents");

	this.container.addChild(this.titleContainer).addChild(this.contentContainer);
};

MinTabs.prototype.getDom = function() {
	return this.container;
};

MinTabs.prototype.addTab = function(title, content) {
	var self = this;
	var tab;

	this.tabs.push( this.createTitle(title) );
	this.contents.push( this.createContent(content) );

	tab = this.tabs[this.tabs.length - 1];

	this.titleContainer.appendChild( tab );
	this.contentContainer.appendChild( this.contents[this.contents.length - 1] );

	$(tab).click(function () {
		self.selectTab(tab);
	});



	if(this.tabs.length === 1){
		this.selectTab(tab);
	}
};

MinTabs.prototype.selectTab = function(tab) {
	$(this.selectedTab).removeClass("active");
	$(tab).addClass("active");


	this.selectedTab = tab;

	for (var i = this.tabs.length - 1; i >= 0; i--) {
		if(this.tabs[i] === tab){
			if(this.selectedContent) 
				this.selectedContent.style.display = "none"

			this.contents[i].style.display = "block";
			this.selectedContent = this.contents[i];

			break;
		}
	}
};

MinTabs.prototype.createTitle = function(title) {
	return createElement("div").setClass("tab")
		.addChild( document.createElement("div").setClass("frame") )
		.addChild( document.createElement("p").setHtml(title).setClass("text")
	);
};

MinTabs.prototype.createContent = function(content) {
	var container = document.createElement("div").setClass("content");
	
	if(Utils.isArray(content)){
		var temp = content.length;
		for (var i = 0; i < temp; i++) {
			container.appendChild( content[i] );
		}
	}else{
		container.addChild(content);
	}
	return container;
};